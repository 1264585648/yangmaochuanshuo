import { briefGuide } from './guide-fixtures';

/** Fictional test data only; example.com is reserved for documentation. */
export function validOffer(): Record<string, unknown> & { conditions: Record<string, unknown> } {
  return {
    id: 'example-ai-credit',
    providerId: 'example',
    pool: 'ai',
    rarity: 'S',
    title: '示例 AI 赠金',
    summary: '用于测试的虚构福利',
    benefit: '示例额度',
    officialUrl: 'https://www.example.com/promo',
    sourceUrl: 'https://docs.example.com/credits',
    conditions: {
      newUsersOnly: true,
      studentOnly: false,
      requiresPaymentMethod: true,
      autoRenews: false,
      regions: [],
      note: '',
    },
    validFrom: null,
    validUntil: null,
    guide: briefGuide(),
  };
}

export const exampleProvider = {
  id: 'example',
  name: 'Example',
  officialDomains: ['example.com'],
};
