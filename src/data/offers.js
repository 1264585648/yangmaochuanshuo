/* Demonstration offers only. No coupon, credit, or real-world entitlement is granted. */

/**
 * @typedef {object} Offer
 * @property {string} id
 * @property {string} pool
 * @property {'A' | 'S' | 'SSR'} rarity
 * @property {string} title
 * @property {string} description
 * @property {string} icon
 * @property {string} requirement
 */

/** @type {readonly Offer[]} */
export const DEMO_OFFERS = Object.freeze(
  [
    {
      id: 'ai-a',
      pool: 'ai',
      rarity: 'A',
      title: 'AI 模型体验包',
      description: '模型试用权益示例，实际以活动规则为准',
      icon: '✦',
      requirement: '可能需要注册账号',
    },
    {
      id: 'ai-s',
      pool: 'ai',
      rarity: 'S',
      title: 'AI 编程助手高级试用',
      description: '开发工具订阅权益示例',
      icon: '⌘',
      requirement: '可能限制新用户',
    },
    {
      id: 'ai-ssr',
      pool: 'ai',
      rarity: 'SSR',
      title: 'AI API 高价值赠金',
      description: '开发者 API 试用额度示例',
      icon: '✧',
      requirement: '可能需要付款方式验证',
    },
    {
      id: 'cloud-a',
      pool: 'cloud',
      rarity: 'A',
      title: 'VPS 新用户折扣',
      description: '云服务器套餐折扣示例',
      icon: '☁',
      requirement: '可能需要新用户身份',
    },
    {
      id: 'cloud-s',
      pool: 'cloud',
      rarity: 'S',
      title: '云平台开发者赠金',
      description: '云端资源体验额度示例',
      icon: '◈',
      requirement: '可能需要支付方式验证',
    },
    {
      id: 'cloud-ssr',
      pool: 'cloud',
      rarity: 'SSR',
      title: 'GPU 算力体验额度',
      description: '高价值计算资源试用示例',
      icon: '⬡',
      requirement: '可能存在地区或资格限制',
    },
    {
      id: 'software-a',
      pool: 'software',
      rarity: 'A',
      title: '设计工具会员试用',
      description: '设计与生产力工具福利示例',
      icon: '▦',
      requirement: '可能限制新用户',
    },
    {
      id: 'software-s',
      pool: 'software',
      rarity: 'S',
      title: '开发 IDE 专业授权',
      description: '软件高级功能体验示例',
      icon: '⌘',
      requirement: '需核对授权范围',
    },
    {
      id: 'software-ssr',
      pool: 'software',
      rarity: 'SSR',
      title: '生产力工具年度权益',
      description: '长期软件授权福利示例',
      icon: '◫',
      requirement: '可能限制领取名额',
    },
    {
      id: 'education-a',
      pool: 'education',
      rarity: 'A',
      title: '在线课程体验资格',
      description: '免费课程资源示例',
      icon: '✎',
      requirement: '需核对课程报名条件',
    },
    {
      id: 'education-s',
      pool: 'education',
      rarity: 'S',
      title: '学生开发工具权益',
      description: '开发工具教育优惠示例',
      icon: '♧',
      requirement: '需要有效学生身份',
    },
    {
      id: 'education-ssr',
      pool: 'education',
      rarity: 'SSR',
      title: '教育软件套装礼包',
      description: '多款软件教育授权福利示例',
      icon: '✥',
      requirement: '需要资格核验',
    },
  ].map((offer) => Object.freeze(offer)),
);
