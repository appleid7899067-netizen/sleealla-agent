FROM golang:1.24.1-alpine AS builder
WORKDIR /build
RUN apk --no-cache add ca-certificates
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -ldflags '-extldflags "-static"' -tags timetzdata -o app .

FROM alpine:3.19 AS app
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /build/app app
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
ENTRYPOINT ["./app"]
