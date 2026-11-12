/**
 * @typedef {object} Pool
 * @property {string} id
 * @property {string} label
 * @property {string} title
 * @property {string} description
 * @property {string} short
 */

/** @type {readonly Pool[]} */
export const POOLS = Object.freeze(
  [
    {
      id: 'cloud',
      label: '云服务器',
      title: '云服务器卡池',
      description: 'VPS、云平台赠金与算力体验',
      short: 'VPS · 云平台 · 赠金',
    },
    {
      id: 'ai',
      label: 'AI 福利',
      title: 'AI 福利卡池',
      description: '精选 AI 工具、模型体验和 API 额度',
      short: '模型 · API · 会员',
    },
    {
      id: 'software',
      label: '软件工具',
      title: '软件工具卡池',
      description: '开发、设计与生产力工具',
      short: '开发 · 设计 · 效率',
    },
    {
      id: 'education',
      label: '教育优惠',
      title: '教育优惠卡池',
      description: '面向学生与学习者的数字福利',
      short: '学生 · 教育 · 课程',
    },
  ].map((pool) => Object.freeze(pool)),
);

/**
 * @param {string} poolId
 * @returns {string}
 */
export function poolLabel(poolId) {
  return POOLS.find((p) => p.id === poolId)?.label ?? '';
}
