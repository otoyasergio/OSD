"use client";

import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import { useSignedImageRecovery } from "@/lib/photos/useSignedImageRecovery";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError"> & {
  src: string;
  alt: string;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export function RecoverableSignedImage({ src, alt, onError, ...imgProps }: Props) {
  const handleError = useSignedImageRecovery(src, onError);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
    <img src={src} alt={alt} onError={handleError} {...imgProps} />
  );
}
