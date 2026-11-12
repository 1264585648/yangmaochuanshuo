/* API-shaped guides for frontend tests, matching worker/src/domain/guide.ts. */

/** @returns {Record<string, unknown>} A valid brief guide. */
export function briefGuide() {
  return {
    kind: 'brief',
    steps: [
      { text: '打开 `控制台` 并登录', bullets: [], notes: [] },
      {
        text: '进入**额度**页面',
        bullets: ['选择地区', '确认套餐'],
        link: { label: '额度页面', url: 'https://www.example.com/quota' },
        notes: [],
      },
      {
        text: '提交申请',
        bullets: [],
        notes: [{ tone: 'warn', title: '需要绑卡', text: '会预授权 1 美元' }],
      },
    ],
  };
}

/** @returns {Record<string, unknown>} A valid full guide with two phases. */
export function fullGuide() {
  return {
    kind: 'full',
    phases: [
      {
        title: '注册账号',
        note: '约 10 分钟',
        steps: [
          { text: '打开注册页', bullets: [], notes: [] },
          { text: '验证邮箱', bullets: [], notes: [] },
        ],
      },
      {
        title: '创建实例',
        note: '',
        steps: [
          {
            text: '运行命令',
            bullets: [],
            code: 'ssh ubuntu@host\nsudo apt update',
            notes: [{ tone: 'danger', title: '会被回收', text: '闲置 7 天的实例会被回收' }],
          },
        ],
      },
    ],
    facts: [{ label: '免费额度', value: '4 核 24 GB', note: '按月计' }],
    faq: [
      { question: '需要信用卡吗？', answer: '需要，仅做验证。', basis: 'official' },
      { question: '会被封号吗？', answer: '少数用户反馈过。', basis: 'community' },
    ],
    references: [
      { title: '官方文档', url: 'https://docs.example.com/free', basis: 'official' },
      { title: '社区教程', url: 'https://blog.example.org/howto', basis: 'community' },
    ],
  };
}
