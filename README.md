# CB-ERP 跨境电商管理系统

生产级跨境电商 ERP，采用 Vue 3 + Vite + TypeScript + Supabase（Auth / PostgreSQL / RLS）+ Vercel 架构。

## 技术栈

- 前端：Vue 3 + Vite + TypeScript + Pinia + Vue Router
- 后端：Vercel Serverless Functions（Server API）
- 数据：Supabase PostgreSQL（Auth + RLS）
- 校验：Zod

## 目录结构

```
src/
├── app/            # 应用级配置
├── components/     # 通用组件
├── layouts/        # 布局
├── pages/          # 页面
├── services/       # API / Supabase 客户端
├── stores/         # Pinia 状态
├── types/          # 类型定义
├── utils/          # 工具
└── router/         # 路由
api/                # Vercel Serverless Functions
supabase/
├── migrations/     # 数据库版本化迁移
├── functions/      # Supabase 边缘函数
└── seed/           # 种子数据
```

## 环境变量

复制 `.env.example` 为 `.env`，填入：

- `VITE_SUPABASE_URL`：Supabase 项目 URL（前端公开，安全）
- `VITE_SUPABASE_ANON_KEY`：Supabase anon key（前端公开，安全）

服务端密钥（`SUPABASE_SERVICE_ROLE_KEY`、`JWT_SECRET`）只配置在 Vercel Environment Variables，绝不进入前端代码。

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run typecheck
npm run build
```

## 安全原则

- 浏览器不直接控制数据库，前端只持 anon key + JWT
- Service Role / Secret Key 只存在于服务端环境变量
- 所有业务 API 强制 JWT 认证 + RBAC + 输入校验
- 数据库通过 RLS + 约束保证最终安全
- 禁止任意表 API、禁止 DELETE ALL + INSERT ALL、库存走流水 + 事务
