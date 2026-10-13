# JTWZ

JTWZ 是一个面向生产环境的综合平台，用于管理多域名跳转、静态网站发布和软件分发。

当前稳定版本：[`v1.1.3`](https://github.com/wstimin/JTWZ/releases/tag/v1.1.3)

它将公开展示端、管理后台和 API 分开构建：公开站负责产品介绍、公告和下载；管理端负责域名、跳转规则、站点、软件、版本、安装包、备份和系统设置；API 负责鉴权、数据持久化、对象存储直传、统计和运行时域名处理。

专业安全能力包括多管理员、所有者/管理员/内容编辑/只读审计四级角色、TOTP 双重验证和恢复码、设备会话撤销、新设备登录告警、CSRF 与来源校验、请求 ID、审计脱敏、上传文件签名校验，以及 systemd/Docker 非 root 运行。

仓库只保存源码、部署脚本和必要教程。`dist/`、`dist-server/`、数据库、临时截图以及 ZIP/TAR 生成物不会提交到仓库。正式安装包由 GitHub Actions 在发布标签后生成，并作为 Release 资产提供下载。

## 1. 服务器部署教程

### 方案 A：一键部署（推荐）

一键脚本是首选入口，支持下载发行包后执行，也支持服务器直接运行一行命令：

```bash
bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' 'https://api.github.com/repos/wstimin/JTWZ/contents/deploy/one-click/install.sh?ref=main')
```

脚本会自动识别服务器公网 IPv4（失败时再提示手动输入公网 IP 或域名），生成生产配置并安装服务。它不会把 `127.0.0.1`、`192.168.x.x`、`10.x.x.x` 等内网地址作为访问地址。安装完成后使用：

没有域名时，服务直接监听公网端口 `8787`，安装完成会显示完整地址：

```text
公开首页：http://公网IP:8787/
管理登录：http://公网IP:8787/{安装时设置的管理后缀}/login
```

如果云服务器启用了安全组，需要放行 TCP `8787`。使用域名和 Nginx 反向代理时则使用标准的 HTTP/HTTPS 端口。

```bash
sudo jt
```

即可调出交互管理菜单；`sudo jtwzctl menu` 仍然兼容。菜单支持访问地址与管理后缀、域名增删改查、SSL 证书管理、配置修改、账号密码修改、完整备份与跨服务器恢复、在线检查更新、服务重启和保留/清除数据卸载。更新会先创建完整备份，同时验证 Ed25519 发布签名和安装包 SHA-256；数据库迁移或健康检查失败时自动恢复上一版程序。

### 方案 B：宝塔

1. 从 [Releases](https://github.com/wstimin/JTWZ/releases) 下载 `jtwz-baota-vX.Y.Z.zip`。
2. 上传到服务器并解压，进入解压目录。
3. 执行：

   ```bash
   sudo ./install.sh
   ```

4. 按向导填写公开域名、管理域名、管理员账号、管理员密码和支持邮箱。
5. 将 DNS 解析指向服务器，安装器会生成 Nginx 和 systemd 配置。
6. 访问管理域名登录后台，在“系统设置”中完成品牌、对象存储、备份和 HTTPS 配置。

宝塔安装器同样会优先自动识别公网 IP；也可以改填已经解析到服务器的公网域名。`127.0.0.1` 只用于服务器内部 API 与反向代理之间的本机通信。

### 方案 C：1Panel

1. 下载 `jtwz-1panel-vX.Y.Z.tar.gz` 并解压。
2. 执行：

   ```bash
   sudo ./install.sh
   ```

3. 向导会生成 Compose 环境并启动容器；数据保存在 Docker volume 中。
4. 在 1Panel 或反向代理中绑定公开域名和管理域名，再登录后台完成系统设置。

SSL 操作要求域名已经解析到当前服务器，并由 certbot/Nginx 完成验证。

### 方案 D：Docker Compose + Caddy

仓库提供 `deploy/docker/docker-compose.yml`，包含持久化 volume、容器健康检查、非 root 运行和 Caddy HTTPS 反向代理。配置 `.env` 与 `JTWZ_DOMAIN` 后执行：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

## 2. 本地开发

```bash
npm install
cp .env.example .env
npm run dev
```

本地开发地址：

```text
公开站：http://127.0.0.1:4173/
管理端：http://127.0.0.1:4174/admin
API：   http://127.0.0.1:8787/
```

生产构建和启动：

```bash
npm run check
npm run build
npm start
```

生产环境必须在 `.env` 中设置 `ADMIN_PASSWORD` 和 `APP_SECRET`。不要把 `.env` 或真实密钥提交到 Git。

## 3. 发布与安装包

提交 `v*` 标签后，`.github/workflows/release-packages.yml` 会自动构建：

- `jtwz-baota-vX.Y.Z.zip`
- `jtwz-1panel-vX.Y.Z.tar.gz`
- `jtwz-one-click-vX.Y.Z.tar.gz`
- `SHA256SUMS`
- `update-manifest.json`（Ed25519 签名更新清单）

安装包只放在 GitHub Release，不会混入源码分支。发布工作流要求仓库 Secret `JTWZ_UPDATE_PRIVATE_KEY_B64`；服务器只保存对应的 Ed25519 公钥。发布前请确认版本号已同步到 `package.json`、安装包 manifest 和备份兼容版本。

## 4. 目录说明

```text
src/                 前端公开站与管理端源码
server/              Node API、鉴权、备份、存储和运行时逻辑
apps/                独立前端入口 HTML
deploy/              宝塔、1Panel、一键部署和反向代理源码
tests/               冒烟测试
docs/                生产部署教程
.github/workflows/   发布安装包的 CI 工作流
```

## 5. 主要路由

```text
/                 公开首页
/downloads        软件下载中心
/downloads/:slug  软件详情和版本历史
${ADMIN_BASE_PATH}/login      管理员登录
${ADMIN_BASE_PATH}            管理后台
${ADMIN_BASE_PATH}/domains    域名管理
${ADMIN_BASE_PATH}/redirects  跳转规则
${ADMIN_BASE_PATH}/sites      静态网站
${ADMIN_BASE_PATH}/software   软件管理
${ADMIN_BASE_PATH}/versions   版本管理
${ADMIN_BASE_PATH}/packages   安装包管理
${ADMIN_BASE_PATH}/settings   系统设置
```

`ADMIN_BASE_PATH` 默认是 `/admin`，可在安装向导、管理后台或 `sudo jt admin-path set /新后缀` 中修改。公开端和管理端使用独立主题偏好，互不影响。

## 6. 生产部署参考

完整的域名、反向代理、对象存储、备份、HTTPS 和安全边界说明见 [docs/PROFESSIONAL_DEPLOYMENT.md](docs/PROFESSIONAL_DEPLOYMENT.md)。
