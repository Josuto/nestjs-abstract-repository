// Inspired in DDD Entity, it models any object that must specify some ID.
// This interface must be implemented by any persistable domain object.
export interface Entity {
  id?: string;
}
