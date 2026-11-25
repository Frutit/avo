import type { ImgHTMLAttributes } from "react";

type ImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

export function Image(props: ImageProps) {
  const imageProps = { ...props } as ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean };
  const fill = imageProps.fill;
  delete imageProps.fill;
  delete (imageProps as typeof imageProps & { priority?: boolean }).priority;
  delete (imageProps as typeof imageProps & { unoptimized?: boolean }).unoptimized;
  return (
    <img
      {...imageProps}
      style={{
        ...imageProps.style,
        ...(fill ? { position: "absolute", width: "100%", height: "100%", inset: 0 } : {}),
      }}
    />
  );
}
