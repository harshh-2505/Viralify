export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class StorageError extends Error {
  constructor() {
    super(
      "The saved analysis library could not be read safely. Its contents have been preserved. Restore data/analyses.json from a backup or move the damaged file before restarting.",
    );
  }
}
