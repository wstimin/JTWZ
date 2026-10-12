# JTWZ

JTWZ 是一个面向生产环境的综合平台，用于管理多域名跳转、静态网站发布和软件分发。

它将公开展示端、管理后台和 API 分开构建：公开站负责产品介绍、公告和下载；管理端负责域名、跳转规则、站点、软件、版本、安装包、备份和系统设置；API 负责鉴权、数据持久化、对象存储直传、统计和运行时域名处理。

仓库只保存源码、部署脚本和必要教程。`dist/`、`dist-server/`、数据库、临时截图以及 ZIP/TAR 生成物不会提交到仓库。正式安装包由 GitHub Actions 在发布标签后生成，并作为 Release 资产提供下载。

## 1. 快速开始

```bash
npm install
cp .env.example .env
npm run dev
```

开发地址：

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

## 2. 服务器部署教程

### 方案 A：宝塔

1. 从 [Releases](https://github.com/wstimin/JTWZ/releases) 下载 `jtwz-baota-vX.Y.Z.zip`。
2. 上传到服务器并解压，进入解压目录。
3. 执行：

   ```bash
   sudo ./install.sh
   ```

4. 按向导填写公开域名、管理域名、管理员账号、管理员密码和支持邮箱。
5. 将 DNS 解析指向服务器，安装器会生成 Nginx 和 systemd 配置。
6. 访问管理域名登录后台，在“系统设置”中完成品牌、对象存储、备份和 HTTPS 配置。

安装器不会自动探测公网 IP，也不会把 `localhost`、私网主机名或 IP 地址当作站点域名；生产安装必须手动填写已经解析到服务器的公网域名。`127.0.0.1` 只用于服务器内部 API 与反向代理之间的本机通信。

### 方案 B：1Panel

1. 下载 `jtwz-1panel-vX.Y.Z.tar.gz` 并解压。
2. 执行：

   ```bash
   sudo ./install.sh
   ```

3. 向导会生成 Compose 环境并启动容器；数据保存在 Docker volume 中。
4. 在 1Panel 或反向代理中绑定公开域名和管理域名，再登录后台完成系统设置。

### 方案 C：一键部署

```bash
tar -xzf jtwz-one-click-vX.Y.Z.tar.gz
cd jtwz-one-click-vX.Y.Z
sudo ./install.sh
sudo jtwzctl menu
```

`jtwzctl` 是真实的服务器管理入口，支持：

- 查看系统、Node、磁盘、服务和 API 健康状态；
- 域名新增、修改、删除和列表查询；
- SSL 证书签发、删除、换域名和续期；
- 生产配置查看、修改和服务重启；
- 管理员用户名和密码修改；
- 完整迁移备份创建与查询；
- 卸载并保留数据，或卸载并清除数据。

SSL 操作要求域名已经解析到当前服务器，并由 certbot/Nginx 完成验证。

## 3. 发布与安装包

提交 `v*` 标签后，`.github/workflows/release-packages.yml` 会自动构建：

- `jtwz-baota-vX.Y.Z.zip`
- `jtwz-1panel-vX.Y.Z.tar.gz`
- `jtwz-one-click-vX.Y.Z.tar.gz`
- `SHA256SUMS`

安装包只放在 GitHub Release，不会混入源码分支。发布前请确认版本号已同步到 `package.json`、安装包 manifest 和备份兼容版本。

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
/admin/login      管理员登录
/admin            管理后台
/admin/domains    域名管理
/admin/redirects  跳转规则
/admin/sites      静态网站
/admin/software   软件管理
/admin/versions   版本管理
/admin/packages   安装包管理
/admin/settings   系统设置
```

## 6. 生产部署参考

完整的域名、反向代理、对象存储、备份、HTTPS 和安全边界说明见 [docs/PROFESSIONAL_DEPLOYMENT.md](docs/PROFESSIONAL_DEPLOYMENT.md)。
