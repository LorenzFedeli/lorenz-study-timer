import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
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
            width: 126,
            height: 126,
            border: "7px solid #2faa5a",
            borderRadius: 32,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            6h
          </div>
          <div
            style={{
              width: 54,
              height: 7,
              borderRadius: 4,
              background: "#2faa5a",
              marginTop: 12,
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
