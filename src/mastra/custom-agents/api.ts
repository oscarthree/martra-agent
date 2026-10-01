import { Router, type Request, type Response } from 'express';
import type { CustomAgentsService } from './service';

// Express 薄层：解析 x-mastra-resource-id（缺省 "default"），把请求透传给 service。
// 全部端点行为在 service 层实现并可无 HTTP 单测，这里不做业务判断。

function resourceIdOf(req: Request): string {
  const header = req.headers['x-mastra-resource-id'];
  return typeof header === 'string' && header !== '' ? header : 'default';
}

function idParamOf(req: Request): string {
  const id = req.params.id;
  return typeof id === 'string' ? id : '';
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    handler(req, res).catch((error: unknown) => {
      console.error('custom-agents route failed:', error);
      res.status(500).json({ errors: [{ code: 'internal_error', message: '服务内部错误' }] });
    });
  };
}

export function createCustomAgentsRouter(service: CustomAgentsService): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const result = await service.list(resourceIdOf(req));
      res.status(result.status).json(result.body);
    }),
  );

  router.get(
    '/:id',
    asyncRoute(async (req, res) => {
      const result = await service.get(resourceIdOf(req), idParamOf(req));
      res.status(result.status).json(result.body);
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const result = await service.create(resourceIdOf(req), req.body);
      res.status(result.status).json(result.body);
    }),
  );

  router.put(
    '/:id',
    asyncRoute(async (req, res) => {
      const result = await service.update(resourceIdOf(req), idParamOf(req), req.body);
      res.status(result.status).json(result.body);
    }),
  );

  router.delete(
    '/:id',
    asyncRoute(async (req, res) => {
      const result = await service.remove(resourceIdOf(req), idParamOf(req));
      res.status(result.status).json(result.body);
    }),
  );

  return router;
}
