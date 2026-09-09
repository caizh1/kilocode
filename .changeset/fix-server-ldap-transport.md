---
---

修复 ChipMate Server 1.2.2 的 LDAP 连接方式：让 Unencrypted 保持明文连接，StartTLS 在普通连接上显式升级，LDAPS 才在连接建立时使用 TLS；保留证书校验与禁止自动降级的安全边界。
