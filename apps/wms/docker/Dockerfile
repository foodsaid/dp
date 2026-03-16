FROM nginx:alpine

# 安装 bash (entrypoint 脚本需要)
RUN apk add --no-cache bash

# 自定义 nginx 配置 (纯静态文件服务)
COPY apps/wms/docker/nginx.conf /etc/nginx/conf.d/default.conf

# env.js 生成器 (容器启动时运行)
COPY apps/wms/docker/docker-entrypoint.sh /docker-entrypoint.d/90-generate-env-js.sh
RUN chmod +x /docker-entrypoint.d/90-generate-env-js.sh

# 复制前端静态文件 (web 资源已上提至 apps/wms/)
COPY apps/wms/*.html apps/wms/*.css apps/wms/*.js apps/wms/favicon.svg /usr/share/nginx/html/

# 第三方库 (条码/QR码生成 + html5-qrcode 扫码库)
COPY apps/wms/vendor/ /usr/share/nginx/html/vendor/
