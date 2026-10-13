# JTWZ 一键部署（首选）

这是 JTWZ 的一键安装入口：安装脚本负责下载/解压应用、自动识别公网 IP、生成生产配置、安装服务，并在结束时提供公网访问地址和管理命令。

## 直接一行命令

```bash
bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' 'https://api.github.com/repos/wstimin/JTWZ/contents/deploy/one-click/install.sh?ref=main')
```

## 使用 Release 压缩包

```bash
tar -xzf jtwz-one-click-vX.Y.Z.tar.gz
cd jtwz-one-click-vX.Y.Z
sudo ./install.sh
```

安装过程会：

1. 通过多个外部服务自动识别公网 IPv4；
2. 显示识别结果并允许改为公网域名；
3. 拒绝回环、私网、链路本地和 CGNAT 地址；
4. 安装 Node、应用、systemd 服务和 Nginx；
5. 设置管理员账号、最低 6 位密码、管理入口后缀并生成随机密钥；
6. 打印公网访问地址与下一步操作。

没有域名时，安装器会让应用监听 `0.0.0.0:8787`，并输出包含端口和自定义后缀的完整登录地址，例如 `http://公网IP:8787/jtwz-console/login`。脚本会尝试放行 UFW/firewalld；云厂商安全组仍需确认允许 TCP `8787`。安装结束前会检查本机 `/api/health`，服务未正常启动时直接显示 systemd 日志并中止，而不会报告安装成功。

脚本不会把 `127.0.0.1`、`10.0.0.0/8`、`172.16.0.0/12` 或 `192.168.0.0/16` 当成访问地址。API 仍绑定本机回环地址，只供 Nginx 内部转发，这是服务隔离，不是公网访问地址。

## `jt` 交互菜单

安装完成后直接输入：

```bash
sudo jt
```

即可打开交互菜单。`sudo jtwzctl menu` 是同一个入口的兼容命令。

菜单包含：

- 系统、Node、磁盘、服务、最近日志和 API 健康状态；
- 查看完整访问地址、当前管理后缀并在线修改；
- 域名列表、新增、修改、删除；
- SSL 证书列表、签发、删除、换域名、续期；
- 生产配置查看、修改和服务重启；
- 管理员用户名和密码修改；
- 完整迁移备份创建、查询与上传恢复；
- 检查 GitHub 最新正式版本并验证 Ed25519 签名后安全更新；
- 卸载并保留数据，或卸载并清除数据。

菜单中的“检查并更新系统”会显示当前版本与目标版本；确认后先创建完整迁移备份，再验证 Release 的 Ed25519 签名清单和安装包 SHA-256。数据库迁移或健康检查失败时会自动恢复上一版程序。也可以直接执行 `sudo jt update`。迁移到另一台服务器时执行 `sudo jt backup restore /备份文件路径.jtwz-backup`。

SSL 证书操作要求域名已经解析到当前服务器，并由 certbot/Nginx 完成验证。
