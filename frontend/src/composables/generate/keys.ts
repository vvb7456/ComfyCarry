import type { ComputedRef, InjectionKey } from 'vue'
import type { GenerateOptionsReturn } from './useGenerateOptions'
import type { ModelState } from '@/stores/generate'
import type { ModelTypeConfig } from '@/config/model-types'

export const GenerateOptionsKey: InjectionKey<GenerateOptionsReturn> = Symbol('GenerateOptions')

export const GenerateModelKey: InjectionKey<{
  modelType: string
  state: ComputedRef<ModelState>
  config: ComputedRef<ModelTypeConfig>
}> = Symbol('GenerateModel')
