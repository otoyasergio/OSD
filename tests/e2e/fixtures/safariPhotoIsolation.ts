export type IsolatedIntakePhotoRow = {
  photo_id: string;
  storage_path: string;
  thumb_storage_path: string | null;
};

type QueryError = { message: string } | null;

type QueryResult = { data: IsolatedIntakePhotoRow[] | null; error: QueryError };

type ThenableQuery = PromiseLike<QueryResult> & {
  select(columns: string): ThenableQuery;
  eq(column: string, value: string): ThenableQuery;
  maybeSingle(): PromiseLike<{ data: IsolatedIntakePhotoRow | null; error: QueryError }>;
  delete(): ThenableQuery;
  in(column: string, values: string[]): PromiseLike<{ error: QueryError }>;
};

export type IsolatedPhotoAdmin = {
  from: (table: string) => unknown;
  storage: {
    from: (bucket: string) => {
      remove: (paths: string[]) => PromiseLike<{ error: QueryError }>;
      download: (path: string) => PromiseLike<{
        data: Blob | null;
        error: QueryError;
      }>;
    };
  };
};

function table(admin: IsolatedPhotoAdmin, name: string): ThenableQuery {
  return admin.from(name) as ThenableQuery;
}

export function objectPathsForPhoto(row: IsolatedIntakePhotoRow): string[] {
  return [row.storage_path, row.thumb_storage_path].filter((path): path is string =>
    Boolean(path)
  );
}

export async function findIntakePhotosByNote(
  admin: IsolatedPhotoAdmin,
  workOrderId: string,
  note: string
): Promise<IsolatedIntakePhotoRow[]> {
  const { data, error } = await table(admin, "intake_photo")
    .select("photo_id, storage_path, thumb_storage_path")
    .eq("work_order_id", workOrderId)
    .eq("notes", note);
  if (error) {
    throw new Error(`findIntakePhotosByNote failed: ${error.message}`);
  }
  return data ?? [];
}

export async function removeIntakePhotoArtifacts(
  admin: IsolatedPhotoAdmin,
  rows: IsolatedIntakePhotoRow[]
): Promise<void> {
  const paths = rows.flatMap(objectPathsForPhoto);
  if (paths.length > 0) {
    const removed = await admin.storage.from("intake-photos").remove(paths);
    if (removed.error) {
      throw new Error(`removeIntakePhotoArtifacts storage: ${removed.error.message}`);
    }
  }
  const photoIds = rows.map((row) => row.photo_id);
  if (photoIds.length > 0) {
    const deleted = await table(admin, "intake_photo").delete().in("photo_id", photoIds);
    if (deleted.error) {
      throw new Error(`removeIntakePhotoArtifacts rows: ${deleted.error.message}`);
    }
  }
}

export async function assertIntakePhotoObjectsAbsent(
  admin: IsolatedPhotoAdmin,
  paths: string[]
): Promise<void> {
  for (const path of paths) {
    const object = await admin.storage.from("intake-photos").download(path);
    if (object.data && !object.error) {
      throw new Error(`object ${path} is still available`);
    }
  }
}

export async function assertIntakePhotoRemoved(
  admin: IsolatedPhotoAdmin,
  row: IsolatedIntakePhotoRow
): Promise<void> {
  const remaining = await table(admin, "intake_photo")
    .select("photo_id")
    .eq("photo_id", row.photo_id)
    .maybeSingle();
  if (remaining.error) {
    throw new Error(`assertIntakePhotoRemoved lookup: ${remaining.error.message}`);
  }
  if (remaining.data) {
    throw new Error(`intake photo ${row.photo_id} is still present`);
  }
  await assertIntakePhotoObjectsAbsent(admin, objectPathsForPhoto(row));
}
