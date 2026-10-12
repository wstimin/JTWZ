# 专业版架构与部署

## 应用边界

本项目采用单仓库、三应用边界：

```text
公开展示端（dist/public）
        │
        ├── HTTPS API
        │
管理后台（dist/admin）
        │
        ▼
Node API（dist-server）── SQLite / 对象存储 / DNS / 证书服务
```

- 公开展示端只包含首页、软件下载中心和软件详情，不打包管理页面或登录状态。
- 管理后台单独构建，包含登录、管理页面和受保护操作。
- API 独立运行，负责鉴权、数据、审计、签名上传下载和域名运行时。
- 公共类型、主题和基础组件继续在仓库内共享，避免两套产品产生视觉和数据模型漂移。

## 推荐域名

```text
https://www.example.com       公开展示端
https://admin.example.com     管理后台
https://api.example.com       API 与静态网站预览
```

自定义跳转域名和静态网站域名应由负载均衡或边缘代理转发到 Node API，由 API 按请求 `Host` 执行跳转或提供已发布网站。

## 构建配置

独立域名部署前设置：

```dotenv
PUBLIC_APP_ORIGIN=https://www.example.com
ADMIN_APP_ORIGIN=https://admin.example.com
VITE_PUBLIC_SITE_URL=https://www.example.com
VITE_ADMIN_SITE_URL=https://admin.example.com
VITE_API_BASE_URL=https://api.example.com
VITE_ADMIN_BASE_PATH=/
```

然后运行：

```bash
npm run build
```

输出目录：

```text
dist/public/     公开站静态文件
dist/admin/      管理端静态文件
dist-server/     API 服务
```

如果部署在同一域名，保留 `VITE_API_BASE_URL`、`VITE_PUBLIC_SITE_URL`、`VITE_ADMIN_SITE_URL` 为空，并使用默认 `VITE_ADMIN_BASE_PATH=/admin/`。此时公开站位于 `/`，管理端位于 `/admin`。

## 安全说明

- API 仅向 `PUBLIC_APP_ORIGIN`、`ADMIN_APP_ORIGIN` 和兼容的 `APP_ORIGIN` 返回凭证型 CORS 响应。
- 写操作继续执行请求来源校验，未授权来源会返回 `403`。
- 管理会话使用 HttpOnly Cookie；推荐三个应用使用同一主域名的子域，以保持严格 SameSite 防护。
- 管理端 HTML 带有 `noindex`、`nofollow` 和 `noarchive`，但这不能替代登录鉴权和服务端权限校验。
- 安装包依旧由浏览器直传对象存储，下载由对象存储或 API 签名地址完成。

## 开发地址

```text
http://127.0.0.1:4173          公开展示端
http://127.0.0.1:4174/admin    管理后台
http://127.0.0.1:8787          API / 生产组合入口
```
