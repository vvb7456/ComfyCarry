import type { InjectionKey } from 'vue'
import type { GenerateOptionsReturn } from './useGenerateOptions'

export const GenerateOptionsKey: InjectionKey<GenerateOptionsReturn> = Symbol('GenerateOptions')
