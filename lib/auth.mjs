// 讀驗證碼:TOS_AUTH 環境變數優先;否則 stdin(TTY 時不回顯,非 TTY 讀第一行)。絕不從 argv 讀。
export async function readAuth({ env = process.env, input = process.stdin, output = process.stderr } = {}) {
  if (env.TOS_AUTH) return env.TOS_AUTH.trim()
  if (input.isTTY) {
    output.write('驗證碼(輸入不顯示): ')
    input.setRawMode(true); input.resume(); input.setEncoding('utf8')
    return await new Promise((resolve, reject) => {
      let buf = ''
      const onData = ch => {
        for (const c of ch) {
          if (c === '\r' || c === '\n') { done(); return resolve(buf.trim()) }
          if (c === '\x03') { done(); return reject(new Error('已取消')) }
          if (c === '\x7f' || c === '\b') buf = buf.slice(0, -1)
          else buf += c
        }
      }
      const done = () => { input.removeListener('data', onData); input.setRawMode(false); input.pause(); output.write('\n') }
      input.on('data', onData)
    })
  }
  let data = ''
  input.setEncoding('utf8')
  for await (const chunk of input) { data += chunk; if (data.includes('\n')) break }
  return data.split('\n')[0].trim()
}
