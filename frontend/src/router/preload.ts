import { loadRouteLocation, type Router } from 'vue-router'

export function preloadRoutes(router: Router): Promise<PromiseSettledResult<unknown>[]> {
  const routes = router.getRoutes().filter(route => route.name && !route.redirect)
  // 单页预加载失败不影响其他页面；实际导航仍可调用原来的加载器。
  return Promise.allSettled(routes.map(route =>
    loadRouteLocation(router.resolve({ name: route.name! })),
  ))
}
