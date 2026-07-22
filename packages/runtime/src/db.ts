// A database handle that is either a pooled connection or an open transaction.
// Both postgres.js `Sql` and `TransactionSql` share the same query/`json`/tagged
// -template surface, so functions that only append or read (writeAudit, the
// guarded read) accept either — which is what lets the same code run inside a
// caller's transaction for the atomic minor_record.read obligation.
import type { Sql, TransactionSql, JSONValue } from 'postgres'

export type Db = Sql | TransactionSql
export type { JSONValue }
