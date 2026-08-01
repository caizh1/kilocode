import { resolve } from "node:path"
import { Store } from "./db.js"
import { hashPassword } from "./security.js"
import { roles, type Role } from "./types.js"

const username = process.argv[2]?.trim()
const role = process.argv[3]?.trim() as Role | undefined
const password = process.env.CHIPMATE_ADMIN_PASSWORD

if (!username || !role || !roles.includes(role) || !password || password.length < 12) {
  console.error("用法：CHIPMATE_ADMIN_PASSWORD='<至少12位>' npm run admin:create -- <用户名> <reporter|maintainer|admin>")
  process.exitCode = 2
} else {
  const path = process.env.CHIPMATE_BUG_DB ?? resolve(process.cwd(), ".runtime/chipmate-bugs.sqlite")
  const store = new Store(path)
  try {
    const id = store.createUser(username, await hashPassword(password), role)
    console.log(`已创建 ChipMate 用户：${username}（编号 ${id}，角色 ${role}）`)
  } finally {
    store.close()
  }
}
