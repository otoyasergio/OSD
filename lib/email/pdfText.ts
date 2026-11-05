import { extractText, getDocumentProxy } from "unpdf";

/** Text of a TopGuru PDF. The shop stores the words, not the file. */
export async function textFromPdf(bytes: Uint8Array): Promise<string> {
  const document = await getDocumentProxy(bytes);
  const result = await extractText(document, { mergePages: true });
  const text = result.text;
  return (Array.isArray(text) ? text.join("\n") : String(text ?? "")).trim();
}
