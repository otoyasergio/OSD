/** Put cloned Files onto a file input after the picker has been cleared. */
export function assignInputFiles(input: HTMLInputElement, files: File[]): void {
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
  }
}
