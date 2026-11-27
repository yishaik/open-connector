FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=1 go build -mod=mod -trimpath -o /bridge .
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m bridge
COPY --from=build /bridge /usr/local/bin/bridge
USER 10001:10001
ENV WA_LISTEN=0.0.0.0:8090 WA_DATA_DIR=/data
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/bridge"]
