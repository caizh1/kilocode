# 固定 Linux x64 构建环境；运行时随包携带 musl，不依赖目标机的 glibc 版本。
FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d AS builder
RUN apk add --no-cache build-base cmake ninja curl python3 freetype-dev fontconfig-dev jpeg-dev openjpeg-dev lcms2-dev libpng-dev zlib-dev
WORKDIR /src
RUN curl -fL --max-time 180 https://poppler.freedesktop.org/poppler-26.02.0.tar.xz -o poppler.tar.xz \
 && echo 'dded8621f7b2f695c91063aab1558691c8418374cd583501e89ed39487e7ab77  poppler.tar.xz' | sha256sum -c - \
 && curl -fL --max-time 180 https://poppler.freedesktop.org/poppler-data-0.4.12.tar.gz -o data.tar.gz \
 && echo 'c835b640a40ce357e1b83666aabd95edffa24ddddd49b8daff63adb851cdab74  data.tar.gz' | sha256sum -c - \
 && tar xf poppler.tar.xz && tar xf data.tar.gz
COPY build.sh /src/build.sh
COPY pdftotext /src/pdftotext
RUN sh /src/build.sh

FROM scratch
COPY --from=builder /out/ /poppler/
