# 工作流（Workflows）

> C4 层级：**C3 Component**（Mastra 容器内负责多步骤编排的组件）。

## 1. 职责

`weatherWorkflow` 将“获取多日天气预报”与“生成活动规划”两个步骤串起来：

1. `fetchWeather`：调用 Open-Meteo 获取指定城市未来 1–7 天预报。
2. `planActivities`：调用 `activityPlannerAgent` 根据预报生成格式化的活动安排。

## 2. 关键文件

| 文件 | 说明 |
| --- | --- |
| `src/mastra/workflows/weather-workflow.ts` | 天气工作流定义 |

## 3. 关键类 / 函数

| 名称 | 来源 | 作用 |
| --- | --- | --- |
| `createWorkflow` | `@mastra/core/workflows` | 定义工作流 |
| `createStep` | `@mastra/core/workflows` | 定义工作流步骤 |
| `fetchWeather` | `weather-workflow.ts` | 第一步：获取预报 |
| `planActivities` | `weather-workflow.ts` | 第二步：生成活动规划 |
| `withRetry` | `weather-workflow.ts` | 指数退避重试 |
| `requiredAt` | `weather-workflow.ts` | 安全访问数组元素，避免 `undefined` |
| `weatherWorkflowInputSchema` | `weather-workflow.ts` | 工作流输入 zod schema（city, days） |

## 4. 调用关系

```text
weatherAgent
    │
    ▼
weatherWorkflow
    │
    ├──▶ fetchWeather
    │       ├──▶ Open-Meteo Geocoding
    │       └──▶ Open-Meteo Forecast
    │
    └──▶ planActivities
            │
            └──▶ activityPlannerAgent.stream(prompt)
                    │
                    └──▶ Moonshot
```

## 5. C4 Code：关键代码

### 5.1 输入 Schema

```typescript
export const weatherWorkflowInputSchema = z.object({
  city: z.string().describe('要获取天气预报的城市'),
  days: z.number().int().min(1).max(7).default(1).describe('预报天数，范围为 1 到 7 天'),
});
```

### 5.2 工作流装配

```typescript
const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: weatherWorkflowInputSchema,
  outputSchema: z.object({ activities: z.string() }),
})
  .then(fetchWeather)
  .then(planActivities);

weatherWorkflow.commit();
export { weatherWorkflow };
```

### 5.3 fetchWeather 输出

```typescript
{
  location: name,
  forecasts: data.daily.time.map((date, index) => ({
    date,
    maxTemp: requiredAt(data.daily.temperature_2m_max, index, 'temperature_2m_max'),
    minTemp: requiredAt(data.daily.temperature_2m_min, index, 'temperature_2m_min'),
    condition: getWeatherCondition(requiredAt(data.daily.weathercode, index, 'weathercode')),
    precipitationChance: requiredAt(data.daily.precipitation_probability_max, index, 'precipitation_probability_max'),
  })),
}
```

### 5.4 planActivities 提示模板

`planActivities` 将预报 JSON 与固定格式模板拼接，要求 `activityPlannerAgent` 输出包含：

- 每天日期
- 天气概况
- 上午/下午户外活动
- 室内备选活动
- 特别注意事项

## 6. 设计要点

- **days 限制 1–7**：与 Open-Meteo 免费接口及业务场景对齐，默认 1 天。
- **数组安全访问**：`requiredAt` 辅助函数在 TypeScript strict + `noUncheckedIndexedAccess` 下保证运行时安全。
- **重试**：地理编码与天气请求均带 `withRetry`，提升弱网稳定性。
- **模板严格保留**：`weatherAgent` 指令要求原样保留 `activities` 中的章节标题、表情符号与完整内容。
