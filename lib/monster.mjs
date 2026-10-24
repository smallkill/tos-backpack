// 解析 tos-tools 的 monsterData.tsx:絕不執行程式碼。用 acorn 產 AST,只讀「純字面值」節點,
// 遇到任何其他節點(函式、呼叫、識別字、模板插值...)一律丟錯。
import { parse } from 'acorn'

function lit(n) {
  switch (n.type) {
    case 'Literal': return n.value
    case 'TemplateLiteral':
      if (n.expressions.length) throw new Error('monsterData: 模板字串含插值,拒絕解析')
      return n.quasis.map(q => q.value.cooked).join('')
    case 'UnaryExpression':
      if ((n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number')
        return n.operator === '-' ? -n.argument.value : n.argument.value
      throw new Error('monsterData: 不允許的一元運算')
    case 'ArrayExpression': return n.elements.map(e => { if (!e) return null; return lit(e) })
    case 'ObjectExpression': {
      const o = {}
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') throw new Error('monsterData: 不允許的屬性型態')
        const k = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null
        if (k == null) throw new Error('monsterData: 不允許的屬性鍵')
        o[k] = lit(p.value)
      }
      return o
    }
    default: throw new Error(`monsterData: 不允許的節點 ${n.type}`)
  }
}

export function parseMonsterData(src) {
  // 只剝掉 export 與型別標註,其餘交給 parser
  const code = src.replace(/export\s+const\s+monsterData\s*:\s*[^=]+=/, 'const monsterData =')
  const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
  if (ast.body.length !== 1 || ast.body[0].type !== 'VariableDeclaration')
    throw new Error('monsterData: 檔案結構不符(預期只有一個宣告)')
  const init = ast.body[0].declarations[0].init
  if (init?.type !== 'ArrayExpression') throw new Error('monsterData 解析失敗')
  const map = new Map()
  for (const el of init.elements) {
    if (el?.type !== 'ObjectExpression') continue
    // 只取搜尋用欄位;其餘(技能長文)不展開
    const want = {}
    for (const p of el.properties) {
      const k = p.key?.name ?? p.key?.value
      if (['id', 'name', 'attribute', 'race', 'star'].includes(k)) want[k] = lit(p.value)
    }
    if (typeof want.id === 'number') {
      map.set(want.id, { id: want.id, name: want.name || '', attribute: want.attribute || '', race: want.race || '', star: want.star || 0 })
    }
  }
  return map
}
