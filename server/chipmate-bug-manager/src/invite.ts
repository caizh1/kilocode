import { resolve } from "node:path"
import { Store } from "./db.js"
import { digest } from "./security.js"

const code = process.env.CHIPMATE_INVITE_CODE?.trim().toUpperCase()

if (!code || !/^CM-[A-F0-9]{24}$/.test(code)) {
  console.error("用法：CHIPMATE_INVITE_CODE='CM-加24位十六进制字符' npm run invite:default")
  process.exitCode = 2
} else {
  const path = process.env.CHIPMATE_BUG_DB ?? resolve(process.cwd(), ".runtime/chipmate-bugs.sqlite")
  const store = new Store(path)
  try {
    if (store.defaultInvite()) {
      console.error("默认邀请码已经存在，未创建新的邀请码")
      process.exitCode = 1
    } else {
      const invite = store.createDefaultInvite(digest(code), code.slice(0, 7))
      console.log(`已创建默认邀请码记录（编号 ${invite.id}，可注册 3 人）`)
    }
  } finally {
    store.close()
  }
}
