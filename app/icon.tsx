import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#050505",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 356,
            height: 356,
            border: "18px solid #2faa5a",
            borderRadius: 88,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 126,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            6h
          </div>
          <div
            style={{
              width: 158,
              height: 18,
              borderRadius: 9,
              background: "#2faa5a",
              marginTop: 34,
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
