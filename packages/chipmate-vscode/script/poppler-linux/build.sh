#!/bin/sh
set -eu
test "$(uname -m)" = x86_64

# 上游 Linux 默认使用编译时的绝对数据路径；只修改工具入口，支持扩展安装目录迁移。
python3 - <<'PY'
from pathlib import Path
path = Path('/src/poppler-26.02.0/utils/pdftotext.cc')
text = path.read_text()
old = 'globalParams = std::make_unique<GlobalParams>();'
assert text.count(old) == 1, '上游 PDF 工具入口已变化，必须重新审核补丁'
new = 'globalParams = std::make_unique<GlobalParams>(std::getenv("CHIPMATE_POPPLER_DATADIR") ? std::getenv("CHIPMATE_POPPLER_DATADIR") : "");'
path.write_text(text.replace(old, new))
PY
cmake -S /src/poppler-26.02.0 -B /src/build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS=-march=x86-64 -DCMAKE_CXX_FLAGS=-march=x86-64 \
  -DBUILD_SHARED_LIBS=OFF -DENABLE_UNSTABLE_API_ABI_HEADERS=OFF \
  -DENABLE_BOOST=OFF -DENABLE_GLIB=OFF -DENABLE_QT5=OFF -DENABLE_QT6=OFF \
  -DENABLE_CPP=OFF -DENABLE_GPGME=OFF -DENABLE_LIBCURL=OFF -DENABLE_NSS3=OFF \
  -DENABLE_GOBJECT_INTROSPECTION=OFF -DENABLE_LIBTIFF=OFF \
  -DBUILD_GTK_TESTS=OFF -DBUILD_QT5_TESTS=OFF -DBUILD_QT6_TESTS=OFF \
  -DBUILD_CPP_TESTS=OFF -DBUILD_MANUAL_TESTS=OFF
cmake --build /src/build --target pdftotext --parallel 4
mkdir -p /out/lib /out/share/poppler /out/licenses
cp /src/build/utils/pdftotext /out/pdftotext.bin
strip /out/pdftotext.bin
# musl 的 ldd 列出完整递归依赖；复制实际文件，避免绝对符号链接指向宿主系统。
ldd /out/pdftotext.bin > /src/依赖清单.txt
awk '/=> \//{print $3} /^\s*\/lib\//{print $1}' /src/依赖清单.txt | while read -r library; do
  cp -L "$library" /out/lib/
done
cp -L /lib/ld-musl-x86_64.so.1 /out/lib/
cp -R /src/poppler-data-0.4.12/cMap /src/poppler-data-0.4.12/cidToUnicode /src/poppler-data-0.4.12/nameToUnicode /src/poppler-data-0.4.12/unicodeMap /out/share/poppler/
cp /src/poppler-26.02.0/COPYING /out/licenses/Poppler-COPYING
cp /src/poppler-data-0.4.12/COPYING* /out/licenses/
# 附带精确源码和入口修改，便于复核及履行上游源码分发要求。
cp /src/poppler.tar.xz /out/licenses/poppler-26.02.0.tar.xz
cp /src/data.tar.gz /out/licenses/poppler-data-0.4.12.tar.gz
cp /src/build.sh /out/licenses/构建脚本.sh
apk info -v > /out/licenses/软件包版本.txt
cp /src/pdftotext /out/pdftotext
chmod 755 /out/pdftotext /out/pdftotext.bin /out/lib/ld-musl-x86_64.so.1
