import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { activityPlannerAgent } from '../agents/activity-planner-agent';
import { withRetry } from '../utils/retry';

const dailyForecastSchema = z.object({
  date: z.string(),
  maxTemp: z.number(),
  minTemp: z.number(),
  precipitationChance: z.number(),
  condition: z.string(),
})

const forecastSchema = z.object({
  location: z.string(),
  forecasts: z.array(dailyForecastSchema),
})

function requiredAt<T>(values: T[], index: number, field: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Weather response is missing ${field} at index ${index}`);
  }
  return value;
}

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: '晴朗',
    1: '大致晴朗',
    2: '局部多云',
    3: '阴天',
    45: '雾',
    48: '沉积雾凇的雾',
    51: '小毛毛雨',
    53: '中等毛毛雨',
    55: '大毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    95: '雷暴',
  }
  return conditions[code] || 'Unknown'
}

const fetchWeather = createStep({
  id: 'fetch-weather',
  description: 'Fetches weather forecast for a given city',
  inputSchema: z.object({
    city: z.string().describe('要获取天气预报的城市'),
    days: z.number().int().min(1).max(7).default(1).describe('预报天数，范围为 1 到 7 天'),
  }),
  outputSchema: forecastSchema,
  execute: async ({ inputData }) => {
    if (!inputData) {
      throw new Error('Input data not found');
    }

    const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(inputData.city)}&count=1`;
    const geocodingResponse = await withRetry(async () => {
      const response = await fetch(geocodingUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response;
    }, 'Geocoding request');
    const geocodingData = (await geocodingResponse.json()) as {
      results: { latitude: number; longitude: number; name: string }[];
    };

    if (!geocodingData.results?.[0]) {
      throw new Error(`Location '${inputData.city}' not found`);
    }

    const { latitude, longitude, name } = geocodingData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${inputData.days}&timezone=auto`;
    const response = await withRetry(async () => {
      const result = await fetch(weatherUrl);
      if (!result.ok) {
        throw new Error(`HTTP ${result.status}`);
      }
      return result;
    }, 'Weather forecast request');
    const data = (await response.json()) as {
      daily: {
        time: string[]
        weathercode: number[]
        temperature_2m_max: number[]
        temperature_2m_min: number[]
        precipitation_probability_max: number[]
      }
    };

    return {
      location: name,
      forecasts: data.daily.time.map((date, index) => ({
        date,
        maxTemp: requiredAt(data.daily.temperature_2m_max, index, 'temperature_2m_max'),
        minTemp: requiredAt(data.daily.temperature_2m_min, index, 'temperature_2m_min'),
        condition: getWeatherCondition(requiredAt(data.daily.weathercode, index, 'weathercode')),
        precipitationChance: requiredAt(
          data.daily.precipitation_probability_max,
          index,
          'precipitation_probability_max',
        ),
      })),
    };
  },
});


const planActivities = createStep({
  id: 'plan-activities',
  description: 'Suggests activities based on weather conditions',
  inputSchema: forecastSchema,
  outputSchema: z.object({
    activities: z.string(),
  }),
  execute: async ({ inputData }) => {
    const forecast = inputData

    if (!forecast) {
      throw new Error('Forecast data not found')
    }

    const prompt = `根据以下 ${forecast.location} 的天气预报，推荐合适的活动：
      ${JSON.stringify(forecast, null, 2)}
      请按照以下格式为预报中的每一天组织回复：

      📅 [星期，月份 日期，年份]
      ═══════════════════════════

      🌡️ 天气概况
      • 天气状况：[简要描述]
      • 温度：[X°C/Y°F 至 A°C/B°F]
      • 降水概率：[X%]

      🌅 上午活动
      户外活动：
      • [活动名称] - [简要描述，包括具体地点/路线]
        最佳时间：[具体时间段]
        注意事项：[相关天气因素]

      🌞 下午活动
      户外活动：
      • [活动名称] - [简要描述，包括具体地点/路线]
        最佳时间：[具体时间段]
        注意事项：[相关天气因素]

      🏠 室内备选活动
      • [活动名称] - [简要描述，包括具体场所]
        适用情况：[会触发此备选活动的天气状况]

      ⚠️ 特别注意事项
      • [任何相关天气预警、紫外线指数、风力状况等]

      要求：
      - 每天推荐 2-3 项有明确时间安排的户外活动
      - 包含 1-2 项室内备选活动
      - 当降水概率 >50% 时，优先推荐室内活动
      - 所有活动都必须与该地点相关
      - 包含具体场所、步道或地点
      - 根据温度考虑活动强度
      - 描述简洁但信息充分

      为保持一致性，请严格使用此格式，并保留示例中的表情符号和章节标题。`;

    const activitiesText = await withRetry(async () => {
      const response = await activityPlannerAgent.stream([
        {
          role: 'user',
          content: prompt,
        },
      ]);

      let text = '';
      for await (const chunk of response.textStream) {
        text += chunk;
      }
      return text;
    }, 'Activity planning request');

    return {
      activities: activitiesText,
    };
  },
});

export const weatherWorkflowInputSchema = z.object({
  city: z.string().describe('要获取天气预报的城市'),
  days: z.number().int().min(1).max(7).default(1).describe('预报天数，范围为 1 到 7 天'),
});

const weatherWorkflow = createWorkflow({
  id: 'weather-workflow',
  inputSchema: weatherWorkflowInputSchema,
  outputSchema: z.object({
    activities: z.string(),
  })
})
  .then(fetchWeather)
  .then(planActivities);

weatherWorkflow.commit();

export { weatherWorkflow };