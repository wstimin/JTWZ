# JTWZ 1Panel 安装包

将发行包解压后执行：

```bash
sudo ./install.sh
```

向导会写入 Compose 环境、启动容器并输出绑定域名所需的入口。容器数据通过 Docker volume 持久化；SSL 域名管理使用一键管理包中的 `jtwzctl` 和 certbot。
