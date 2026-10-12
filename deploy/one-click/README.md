# JTWZ 一键部署包

```bash
tar -xzf jtwz-one-click-*.tar.gz
cd jtwz-one-click-*
sudo ./install.sh
sudo jtwzctl menu
```

安装向导会要求填写公开域名、管理域名、管理员账号和密码，并生成生产环境配置。

`jtwzctl` 是真实服务器管理入口：

- 查看系统、Node、磁盘、服务和 API 健康状态；
- 域名列表、新增、修改、删除；
- SSL 证书列表、签发、删除、换域名和续期；
- 查看和修改允许的生产配置并自动重启服务；
- 修改管理员账号和密码；
- 创建和查看完整迁移备份；
- systemd 或 Docker 服务重启。

卸载提供两种明确模式：`jtwzctl uninstall` 会询问保留数据或清除数据；菜单中的“卸载并保留数据”和“卸载并清除数据”分别执行对应模式。保留模式会把数据移动到 `/opt/jtwz-data-时间戳`，清除模式删除应用数据和 Docker 数据卷。

证书操作使用服务器上的 certbot 和 Nginx，域名必须已经解析到当前服务器并由管理员确认所有权。
