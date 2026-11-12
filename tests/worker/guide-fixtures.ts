/**
 * Guide fixtures. `oracleGuide` is a hand transcription of the approved
 * Oracle Cloud sample page (2026-11-11), so the schema is proven to hold a
 * real full guide. Third-party screenshots are omitted on purpose; only the
 * self-captured signup screenshot is referenced.
 */

export function briefGuide(): Record<string, unknown> {
  return {
    kind: 'brief',
    steps: [
      { text: '打开官方活动页并登录账户' },
      { text: '点击 **立即领取**，按提示完成验证' },
      { text: '在账户的 `额度` 页面确认已到账' },
    ],
  };
}

export function fullGuide(): Record<string, unknown> {
  return {
    kind: 'full',
    phases: [
      {
        title: '注册账户',
        note: '约 10 分钟',
        steps: [
          {
            text: '打开官方注册页，填写邮箱',
            link: { label: '官方注册页', url: 'https://www.example.com/signup' },
          },
          { text: '验证邮箱后设置密码' },
          { text: '登录控制台' },
        ],
      },
    ],
  };
}

export function oracleGuide(): Record<string, unknown> {
  return {
    kind: 'full',
    facts: [
      {
        label: 'ARM 服务器（Ampere A1）',
        value: '2 核 · 12 GB',
        note: '按每月 1,500 OCPU 小时、9,000 GB 小时计，可一台用满或拆成两台',
      },
      {
        label: 'AMD 小机（E2.1.Micro）',
        value: '2 台',
        note: '每台 1/8 核、1 GB 内存、50 Mbps 公网带宽',
      },
      { label: '块存储', value: '200 GB', note: '启动卷和数据卷合计，另含 5 个备份' },
      { label: '出站流量', value: '10 TB / 月', note: '25 端口默认封禁' },
      { label: '对象存储', value: '20 GB', note: '试用结束后的免费额度，每月 5 万次请求' },
      { label: '数据库', value: '2 个', note: 'Autonomous Database，每个 1 核、20 GB' },
      {
        label: '试用额度（新账户）',
        value: '$300 · 30 天',
        note: '可用于付费资源；到期后用它创建的付费资源会被回收',
      },
    ],
    phases: [
      {
        title: '注册账户',
        note: '约 15 分钟，需要邮箱、手机号和一张信用卡',
        steps: [
          {
            text: '打开官方注册页，选择账单国家或地区，填写姓名和邮箱，然后点 `Verify my email`。',
            link: { label: 'signup.oraclecloud.com', url: 'https://signup.oraclecloud.com/' },
            figure: {
              src: '/guides/oracle-cloud-always-free/signup.png',
              alt: 'Oracle Cloud 注册页：账单国家、姓名、邮箱输入框和 Verify my email 按钮',
              caption: 'DealDex 自截 · 2026-11-11 · 官方注册页首屏',
            },
            notes: [
              {
                tone: 'warn',
                title: '每人只能有一个免费账户',
                text: '注册页明确禁止重复注册。联系信息和账单信息必须真实有效，否则账户可能被暂停或终止。',
              },
            ],
          },
          {
            text: '查收主题为 `Confirm your Oracle cloud account` 的邮件并点击其中的链接。链接 **30 分钟**内有效，过期需要重新发送。',
          },
          {
            text: '回到注册页，设置密码，填写 Cloud account name，选择 **Home Region**（注册地区），勾选确认框。',
            bullets: [
              '密码 8 到 40 位，须同时包含大写、小写、数字和特殊字符，不能含姓名、邮箱或空格。',
              '**Home Region 选定后不能修改**，免费服务器只能创建在这个地区。',
              '官方提示首尔、东京的 ARM 容量紧张，打算用 ARM 服务器的话建议选别的地区。',
            ],
          },
          {
            text: '填写地址和电话，点 `Add payment verification method` → `Credit Card`，输入卡片信息后点 `Finish`。',
            bullets: [
              '借记卡也可以，但需要带 Visa、Mastercard、Discover 或 American Express 标志，并且付款时不需要输入 PIN。',
              '卡上会出现一笔小额临时扣款，这是验证用的预授权，会自动撤销。除非你主动升级账户，否则不会扣费。',
            ],
          },
          {
            text: '接受条款，点 `Start my free trial`。开通完成后会自动进入控制台，同时收到一封 Get Started 邮件。',
          },
        ],
      },
      {
        title: '创建免费 ARM 服务器',
        note: '约 10 分钟',
        steps: [
          {
            text: '在控制台进入 **Compute → Instances**，点 `Create instance`。名称可以保留默认值，Availability domain 先用默认的 AD 1。',
          },
          {
            text: '镜像选 Ubuntu 或 Oracle Linux。点 `Change shape`，选带 `Always Free-eligible` 标记的 `VM.Standard.A1.Flex`，**OCPU 填 2，内存填 12 GB**。',
            notes: [
              {
                tone: 'danger',
                title: '很多教程里的 4 核 24 GB 是旧额度',
                text: '请按现行的 2 核 12 GB 填写。试用结束时 ARM 实例合计超出这个额度，所有 ARM 实例都会被停用，30 天后删除。',
              },
            ],
          },
          {
            text: '网络保持默认设置。SSH 密钥可以上传自己的 `.pub` 公钥，也可以选 Generate a key pair for me，然后**立即下载私钥**，关闭页面后就无法再下载。',
          },
          {
            text: '启动卷保持默认大小即可（约 47 GB）。',
            notes: [
              {
                tone: 'warn',
                title: '不建议填 200 GB',
                text: '200 GB 是启动卷和数据卷合计的全部免费额度，一台机器占满后，第二台机器就没有免费空间了。',
              },
            ],
          },
          {
            text: '点 `Create`。状态变成 `Running` 后，在列表里记下公网 IP，然后用 SSH 登录。Ubuntu 镜像的默认用户是 `ubuntu`，Oracle Linux 是 `opc`。',
            code: 'ssh -i ~/.ssh/你的私钥 ubuntu@公网IP',
          },
        ],
      },
      {
        title: '放行网站端口（可选）',
        note: '只有要对外提供网站时才需要',
        steps: [
          {
            text: '进入实例所在的 VCN → 子网 → **Security List**，点 `Add Ingress Rules`：Source CIDR 填 `0.0.0.0/0`，协议 TCP，**Destination Port Range** 填 `443`。用同样的方法再加一条 `80`。',
            notes: [
              {
                tone: 'danger',
                title: '端口要填在目标端口一栏',
                text: '不要把 443 填在 Source Port Range，那样规则不会生效。Source Port Range 留空。',
              },
            ],
          },
          {
            text: '服务器自身的防火墙默认也会拦截这两个端口，需要在实例内再放行一次并保存（以 Ubuntu 为例）：',
            code: [
              'sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT',
              'sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT',
              'sudo netfilter-persistent save',
            ].join('\n'),
          },
        ],
      },
    ],
    faq: [
      {
        question: '创建时提示 Out of host capacity',
        answer:
          '说明所在地区的免费 ARM 资源暂时用完了。可以换一个 Availability domain、过一段时间再试，或者升级为按量付费账户。',
        basis: 'official',
      },
      {
        question: '服务器闲置可能被回收',
        answer:
          '如果连续 7 天内 CPU 使用率（95 分位）、网络使用率都低于 20%（ARM 机型还包括内存），Oracle 可能回收这台免费实例。',
        basis: 'official',
      },
      {
        question: '30 天试用结束后会怎样',
        answer: '账户继续保留，免费资源不受影响。用试用额度创建的付费资源会被回收，除非升级账户。',
        basis: 'official',
      },
      {
        question: '注册被拒怎么办',
        answer:
          '姓名和地址要与银行卡一致，注册时不要使用代理或匿名邮箱，确认卡片能通过 3-D Secure 验证；被拒后隔一段时间再试。',
        basis: 'community',
      },
    ],
    references: [
      {
        title: 'Always Free Resources',
        url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm',
        basis: 'official',
      },
      {
        title: 'Oracle Cloud Free Tier',
        url: 'https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm',
        basis: 'official',
      },
      {
        title: 'Signing Up for Oracle Cloud Infrastructure',
        url: 'https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm',
        basis: 'official',
      },
      {
        title:
          'How to Set Up a Free Oracle Cloud VM for Web Development (2025 Guide) · Oleg Pustovit',
        url: 'https://dev.to/opustovit/how-to-set-up-a-free-oracle-cloud-vm-for-web-development-2025-guide-8hm',
        basis: 'community',
      },
      {
        title: "Oracle's famous free 4-core/24GB ARM tier is now 2-core/12GB · karthik",
        url: 'https://dev.to/karthik_yk/oracles-famous-free-4-core24gb-arm-tier-is-now-2-core12gb-check-the-docs-2jln',
        basis: 'community',
      },
    ],
  };
}
