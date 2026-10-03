declare module "heic-decode" {
  export type HeicDecodedImage = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  };

  export default function decodeHeif(input: {
    buffer: Buffer;
  }): Promise<HeicDecodedImage>;
}
