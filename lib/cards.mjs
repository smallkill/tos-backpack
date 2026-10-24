// 把原始背包 profile 彙整成公開用的 cards.json(不含 uid / 暱稱 / 互助訊息等個資)。
export function buildCards(profile, monsters, now = new Date()) {
  const rawCards = profile?.userData?.cards
  if (!Array.isArray(rawCards)) throw new Error('profile 格式不符:缺 userData.cards')
  const byId = new Map()
  for (const c of rawCards) {
    const e = byId.get(c.id)
    if (!e) {
      byId.set(c.id, {
        id: c.id, count: 1,
        maxLevel: c.level ?? 0, maxSkillLevel: c.skillLevel ?? 0, maxEnhanceLevel: c.enhanceLevel ?? 0,
      })
    } else {
      e.count++
      e.maxLevel = Math.max(e.maxLevel, c.level ?? 0)
      e.maxSkillLevel = Math.max(e.maxSkillLevel, c.skillLevel ?? 0)
      e.maxEnhanceLevel = Math.max(e.maxEnhanceLevel, c.enhanceLevel ?? 0)
    }
  }
  const unknownIds = []
  const cards = [...byId.values()].sort((a, b) => a.id - b.id).map(e => {
    const m = monsters.get(e.id)
    if (!m || !m.name) {
      unknownIds.push(e.id)
      return { ...e, name: '未知卡號', attribute: '', race: '', star: 0, unknown: true }
    }
    return { ...e, name: m.name, attribute: m.attribute, race: m.race, star: m.star }
  })
  return {
    updatedAt: now.toISOString().slice(0, 10),
    totalCards: rawCards.length,
    uniqueCards: cards.length,
    unknownCount: unknownIds.length,
    cards,
  }
}

// 全卡片名單(沒擁有的卡也能查名稱):陣列 [id,name,attribute,race,star],省體積。
export function buildMonsterList(monsters) {
  return [...monsters.values()]
    .filter(m => m.id > 0 && m.name)
    .sort((a, b) => a.id - b.id)
    .map(m => [m.id, m.name, m.attribute, m.race, m.star])
}
