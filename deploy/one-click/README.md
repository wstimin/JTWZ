# JTWZ 一键部署（首选）

这是类似 3x-ui 的一键安装入口：安装脚本负责下载/解压应用、自动识别公网 IP、生成生产配置、安装服务，并在结束时提供公网访问地址和管理命令。

## 直接一行命令

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/wstimin/JTWZ/main/deploy/one-click/install.sh)
```

## 使用 Release 压缩包

```bash
tar -xzf jtwz-one-click-v1.0.0.tar.gz
cd jtwz-one-click-v1.0.0
sudo ./install.sh
```

安装过程会：

1. 通过多个外部服务自动识别公网 IPv4；
2. 显示识别结果并允许改为公网域名；
3. 拒绝回环、私网、链路本地和 CGNAT 地址；
4. 安装 Node、应用、systemd 服务和 Nginx；
5. 生成管理员账号、随机密钥和数据目录；
6. 打印公网访问地址与下一步操作。

脚本不会把 `127.0.0.1`、`10.0.0.0/8`、`172.16.0.0/12` 或 `192.168.0.0/16` 当成访问地址。API 仍绑定本机回环地址，只供 Nginx 内部转发，这是服务隔离，不是公网访问地址。

## `jt` 交互菜单

安装完成后直接输入：

```bash
sudo jt
```

即可打开交互菜单。`sudo jtwzctl menu` 是同一个入口的兼容命令。

菜单包含：

- 系统、Node、磁盘、服务和 API 健康状态；
- 域名列表、新增、修改、删除；
- SSL 证书列表、签发、删除、换域名、续期；
- 生产配置查看、修改和服务重启；
- 管理员用户名和密码修改；
- 完整迁移备份创建与查询；
- 卸载并保留数据，或卸载并清除数据。

SSL 证书操作要求域名已经解析到当前服务器，并由 certbot/Nginx 完成验证。
