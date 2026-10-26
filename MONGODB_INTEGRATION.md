# MongoDB integration

> MediCore stores **all** application data in MongoDB. There is no relational
> database, no SQLite fallback, no ORM migrations, and no dual-write. This
> document explains how the integration works, what it supports, what it does
> **not** support, and how to operate it safely.

---

## 1. Why this integration, and what it replaced

Django's ORM is hard-wired to a relational backend (`django.db.models`).
Using MongoDB with Django therefore means choosing an object-document mapper.
The options considered:

| Option | Verdict |
| --- | --- |
| **MongoEngine 0.29.1 + PyMongo 4.10.1** | **Chosen.** Mature ODM, declarative `Document` classes, indexes declared in code, embedded documents, `QuerySet` API close enough to Django's for views/serializers, first-class `BinaryField`/`ObjectId`/`DecimalField` support. |
| Djongo | Rejected — abandoned upstream, known to break on modern Django, generates invalid SQL-ish queries. |
| MongoEngine via `django-mongodb-engine` | Rejected — unmaintained, targets Django ≤ 1.10. |
| MongoDB Atlas Data API / raw PyMongo only | Rejected — no schema layer, indexes hand-managed, far more boilerplate per collection. |

Because no part of the stack uses `django.db`, the following Django features are
**not available** (see §6 for the full list): migrations, `django.contrib.admin`,
relational `AUTH_USER_MODEL` sessions, and `transaction.atomic`.

---

## 2. Connection lifecycle

`apps/core/db.py` owns the connection:

* `connect()` is idempotent and is called from `CoreConfig.ready()`, so any
  process (WSGI worker, management command, test session) that imports Django
  gets a live connection.
* A single `MongoClient` (with an internal pool) is shared per process.
  `MONGODB_MAX_POOL_SIZE` (default 50) controls the pool.
* `ping()` powers `GET /api/health/`; it never raises.
* `supports_transactions()` reports whether multi-document transactions are
  usable (requires a replica set **and** `MONGODB_USE_TRANSACTIONS=true`).

### The database-name rule (important)

The database name comes from **`MONGODB_DB` only**. Any database path inside
`MONGODB_URI` is stripped before the client is created:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017          # host(s) and options only
MONGODB_DB=medicore                            # the database that is used
```

Why this matters: pymongo keeps a URI path as the client's *default* database,
and MongoEngine resolves documents against that default — silently ignoring the
explicit `db=` argument. During development this caused the test suite to connect
to `medicore` instead of `medicore_test` and **drop the development database's
collections** on every run. Three defences now exist:

1. `strip_database_from_uri()` removes the path (credentials, hosts, replica-set
   and TLS options are preserved).
2. `connect()` verifies the resolved database name and raises instead of
   continuing if it does not match `MONGODB_DB`.
3. `reset_database()` guards on the name of the database the connection is
   *actually* bound to, and refuses to drop collections unless that name contains
   `test` (or `force=True` is passed explicitly).

Regression tests: `tests/test_db_isolation.py`.

---

## 3. Document model conventions

Every collection follows the same conventions (`apps/*/documents.py`):

* `meta = {"collection": ..., "indexes": [...]}` — indexes are declared next to
  the fields they protect and created by `manage.py ensure_indexes` (also run
  automatically on connect; failures are logged, never fatal).
* Object references are stored as **`*_doc_id` strings** plus a denormalised
  display name (`patient_name`, `staff_name`, …). This keeps list screens to a
  single query and avoids `ReferenceField` dereference storms.
* Embedded sub-documents are used for value objects that are always read with
  their parent: `tests`, `tests_detail`, `components`, `prescriptions`,
  `diagnosis`, `amendments`, `status_history`, `audit` metadata.
* Audit/amendment trails are **append-only arrays**; the code never rewrites
  earlier entries, which is what makes "amend, don't overwrite" provable.
* Human-readable business keys (`PT-000001`, `STF-0004`, `LAB-000017`,
  `APT-000025`, `LOC-000002`) come from a `counters` collection
  (`$inc` on the counter document) rather than `ObjectId` strings, so staff can
  quote them on the phone.
* Every timestamp is stored as a timezone-aware UTC `datetime`; the clinic's
  wall-clock day is derived with `clinic_tz()` (`Africa/Lagos` by default).

### Uniqueness where it matters

| Rule | Mechanism |
| --- | --- |
| One user per email | unique index on `users.email` |
| One staff record per staff ID / email | unique indexes |
| One patient number, one card number | unique indexes |
| **One open attendance session per staff member** | partial unique index `uniq_open_attendance_session` on `attendance_records` with `partialFilterExpression: {"is_open": true}` |
| One result per test per request | compound unique index |
| Idempotent counters | `find_one_and_update` with `$inc`, `upsert=True` |

The partial unique index is deliberate: a staff member may legitimately clock out
and clock back in on the same day (new `_id`, therefore allowed), but a second
*simultaneously open* session is rejected by the database — not merely by
application code — and surfaces as `409 already_clocked_in`. MongoEngine raises
`mongoengine.errors.NotUniqueError` (not `pymongo.errors.DuplicateKeyError`), and
the attendance service maps that to the 409.

> Index changes are **not** applied automatically when a conflicting index
> already exists. Drop the old index by name (`db.attendance_records.dropIndex(...)`)
> then run `python manage.py ensure_indexes`; verify with
> `db.collection.getIndexes()`.

---

## 4. What MongoDB buys us here

* **Embedded clinical documents** — a consultation with its diagnosis list and
  prescriptions is one read, not five joins.
* **Schema evolution without downtime** — new optional fields (e.g. the
  `updated_by` on staff) need no migration; documents missing the field simply
  read as `None`/default.
* **Append-only audit trails** are natural: `$push` onto `amendments`,
  `status_history`, `audit_logs`.
* **Partial indexes** make "at most one open session" enforceable at the storage
  layer while still allowing same-day re-clock-ins.
* **Single-datastore operations** — `mongodump`/`mongorestore` is the whole
  backup story, and there is no cross-store consistency problem to reason about.

---

## 5. What MongoDB costs us (and how the code compensates)

| Limitation | Consequence | Mitigation in this codebase |
| --- | --- | --- |
| No cross-collection ACID by default | A failure midway through e.g. "release report + bump request status" can leave partial state. | Operations are ordered so the *last* step is the visible one (status flips to `released` only after the report document is written); every step is idempotent; `supports_transactions()` exists for deployments that run a replica set. |
| No `transaction.atomic` rollback | Cannot simply "undo" on exception. | Compensating writes + unique indexes; card issuance during registration is wrapped so a failure to issue a card never loses the patient record. |
| No `select_related` | Easy N+1 queries. | Denormalised `*_name` columns and embedded value objects; list endpoints return summary shapes only. |
| No server-side joins | Cross-entity reports need care. | `apps/core/reports.py` and `dashboard.py` aggregate with `$group`/`count_documents` and reuse lookup maps built once per request. |
| Cursors are lazy and unbounded | `list(queryset)` on a large collection loads everything. | `paginate()` in `apps/core/utils.py` clamps `page_size` (default 20, max 100); dashboard/report queries are date-bounded. |
| No SQL `ILIKE` | Regex search is O(n) without an index. | Search inputs are escaped (`re.escape`) and capped in length; see §7 for scale-out options. |
| No Django admin / migrations | Operational tooling must be written. | `manage.py` commands: `seed_demo`, `ensure_indexes`, `purge_sessions`; settings/CRUD endpoints in `/api/settings/` and `/api/staff/`. |
| Field-set is strict | Writing an undeclared attribute raises `FieldDoesNotExist`. | Documents are the schema; a deployment that adds a field must restart the API process (runserver `--noreload` will not pick it up). |
| `_id` is an `ObjectId` | Passing arbitrary strings to `id=` raises `InvalidId`. | Routes accept either the business key (`PT-000001`) or a 24-hex `_id`, validated for length before use. |

---

## 6. Django/DRF features that are **not** used (and why)

* `django.db` models, migrations, `makemigrations`, `migrate` — no relational DB.
* `django.contrib.admin` — it is ORM-bound; administrative screens are React
  pages backed by the REST API instead.
* `django.contrib.sessions` / `django.contrib.auth` login sessions — authentication
  is stateless bearer tokens stored (hashed) in `auth_sessions`, with
  `token_version` revocation. `AUTHENTICATION_BACKENDS` is unused.
* `django.contrib.contenttypes`, permissions framework — replaced by the explicit
  role sets in `apps/core/permissions.py`.
* DRF `ModelSerializer` — plain `Serializer` classes validate request bodies.
* `select_for_update`, `transaction.atomic`, DB constraints beyond unique indexes.

Authentication and permission **enforcement** are still entirely server-side:
every view declares `permission_classes` and then calls `require_roles(...)`
plus object-level checks (e.g. a laboratory scientist may only open a patient
record that has a laboratory request).

---

## 7. Operating MongoDB

### Local development (no Docker)

```bash
# Debian/Ubuntu x86-64 example — MongoDB Community tarball
curl -LO https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-debian12-8.0.4.tgz
tar -xzf mongodb-linux-x86_64-debian12-8.0.4.tgz
mkdir -p ~/.cache/mongo/data
ulimit -n 65536                       # mongod aborts with error:24 otherwise
~/.cache/mongo/mongodb-linux-x86_64-debian12-8.0.4/bin/mongod \
  --dbpath ~/.cache/mongo/data --bind_ip 127.0.0.1 --port 27017 \
  --logpath ~/.cache/mongo/mongod.log --fork
```

> The `ulimit -n 65536` line is not optional on constrained hosts (containers,
> sandboxes): mongod fails to start its storage engine with
> `__posix_directory_sync ... error:24` when the file-descriptor limit is low.

### Docker (simplest for a laptop)

```bash
docker run -d --name medicore-mongo -p 27017:27017 \
  -v medicore-mongo:/data/db mongo:8.0
```

### Replica set (needed only for transactions)

```bash
mongod --replSet rs0 --dbpath /data/db --bind_ip_all
mongosh --eval 'rs.initiate()'
# .env
MONGODB_REPLICA_SET=rs0
MONGODB_USE_TRANSACTIONS=true
```

### Indexes

```bash
python manage.py ensure_indexes        # idempotent; run after every deploy
```

### Backup and restore

```bash
mongodump --db medicore --out /var/backups/medicore-$(date +%F)
mongorestore --db medicore --drop /var/backups/medicore-$(date +%F)/medicore
```

Schedule `mongodump` nightly and store the archive off-box (see
`docs/SECURITY_NDPA.md` for retention guidance).

### Production checklist

* Enable MongoDB authentication and create a least-privilege user
  (`readWrite` on the `medicore` database only); put the credentials in
  `MONGODB_URI` as `mongodb://user:pass@host:27017/?authSource=admin`.
* Keep the URI path empty — the database is chosen by `MONGODB_DB` (§2).
* Terminate TLS at MongoDB or use `tls=true` in the URI; never expose 27017 to
  the internet.
* Run at least a 3-node replica set for durability and failover.
* Set `MONGODB_MAX_POOL_SIZE` to roughly `workers × expected concurrent queries`.

---

## 8. Scale-out options (not implemented, documented honestly)

* **Full-text search** — global search uses case-insensitive regex over
  `full_name`, `patient_number`, phone and email. Beyond ~10⁵ patients, add a
  MongoDB text index or Atlas Search index on those fields. The search service is
  isolated in `apps/core/search.py`, so this is a localised change.
* **Time-series collections** for vitals at high volume.
* **Sharding** by `patient_doc_id` if a single replica set is outgrown.
* **Change streams** for a future integration bus (e.g. pushing released lab
  reports to a patient portal).

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ServerSelectionTimeoutError` on boot | mongod not running / wrong host | start mongod, check `MONGODB_URI` |
| `MongoDB connection resolved to database 'X' but 'Y' was requested` | URI contained a database path | remove the path, set `MONGODB_DB` |
| `Refusing to drop collections in database 'medicore'` | destructive reset attempted against a non-test DB | use `medicore_test`, or pass `force=True` deliberately |
| mongod exits with `error:24` | file-descriptor limit too low | `ulimit -n 65536` before starting |
| `FieldDoesNotExist: The fields "{'x'}" do not exist` | API process running older document definitions | restart the API (runserver `--noreload` does not reload) |
| `Cannot resolve field` / `code 85/86` on index creation | index spec references a field that is not declared, or an old index conflicts | fix the spec, drop the stale index by name, re-run `ensure_indexes` |
| 500 on a duplicate clock-in | only `DuplicateKeyError` was caught | catch `mongoengine.errors.NotUniqueError` too (already handled) |

---

## 10. Verifying the integration yourself

```bash
cd backend
ulimit -n 65536
python -m pytest tests/test_db_isolation.py -q     # connection is bound to MONGODB_DB
python -m pytest tests/ -q                          # 105 tests, MongoDB only
python manage.py ensure_indexes
python scripts/smoke_api.py                         # 81 full-stack HTTP checks
```
