FROM golang:1.26-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o server ./cmd/server

FROM alpine:3.20
# ca-certificates: HTTPS calls to Google Drive; tzdata: Asia/Jakarta
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 app && mkdir -p /data/uploads && chown -R app /data
WORKDIR /app
COPY --from=builder /app/server .
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["./server"]
