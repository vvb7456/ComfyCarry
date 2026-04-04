<script setup lang="ts">
import RangeField from '@/components/form/RangeField.vue'
import NumberInput from '@/components/form/NumberInput.vue'
import { ref } from 'vue'

defineOptions({ name: 'DevPreview' })

const steps = ref(20)
const cfg = ref(7)
const denoise = ref(0.7)
const upscale = ref(2)
const batch = ref(1)
const width = ref(1024)
const height = ref(1024)
</script>

<template>
  <div style="max-width: 700px; margin: 40px auto; display: flex; flex-direction: column; gap: 32px;">

    <!-- ===== 对比组: NumberInput (gen-batch) ===== -->
    <div>
      <h2 class="dev-label">对比 — NumberInput (生成数量, 自定义 spinner)</h2>

      <p class="dev-sub">旧样式 (.gen-spinner-wrap)</p>
      <div style="position:relative;display:flex;width:120px">
        <input type="number" value="1" min="1" max="16" step="1"
          style="width:100%;padding:8px 12px;padding-right:28px;border-radius:6px;border:1px solid var(--bd);background:var(--bg);color:var(--t1);font-size:.85rem;font-family:inherit;outline:none;-moz-appearance:textfield">
        <div style="position:absolute;right:1px;top:1px;bottom:1px;width:24px;display:flex;flex-direction:column;border-left:1px solid var(--bd);border-radius:0 6px 6px 0;overflow:hidden">
          <button style="flex:1;display:flex;align-items:center;justify-content:center;background:var(--bg3);border:none;color:var(--t2);cursor:pointer;padding:0;line-height:1">
            <span class="ms" style="font-size:12px">expand_less</span>
          </button>
          <button style="flex:1;display:flex;align-items:center;justify-content:center;background:var(--bg3);border:none;border-top:1px solid var(--bd);color:var(--t2);cursor:pointer;padding:0;line-height:1">
            <span class="ms" style="font-size:12px">expand_more</span>
          </button>
        </div>
      </div>

      <p class="dev-sub" style="margin-top: 16px;">新组件 NumberInput</p>
      <NumberInput v-model="batch" :min="1" :max="16" :step="1" style="width: 120px;" />
    </div>

    <!-- ===== 自定义分辨率 (2列) ===== -->
    <div>
      <h2 class="dev-label">NumberInput — 自定义分辨率 (center + 2列)</h2>
      <div style="display: flex; align-items: center; gap: 6px; width: 280px;">
        <NumberInput v-model="width" :min="64" :max="8192" :step="64" center style="flex: 1;" />
        <span style="color: var(--t3); flex-shrink: 0;">×</span>
        <NumberInput v-model="height" :min="64" :max="8192" :step="64" center style="flex: 1;" />
      </div>
    </div>

    <!-- ===== 对比组: RangeField — 步数 ===== -->
    <div>
      <h2 class="dev-label">对比 — RangeField (步数, 整数, editable)</h2>

      <p class="dev-sub">旧样式 (.gen-field + .gen-range)</p>
      <div style="display:flex;flex-direction:column;gap:4px">
        <label style="font-size:.78rem;font-weight:500;color:var(--t2);display:flex;justify-content:space-between">
          <span>步数</span>
          <span style="color:var(--ac);font-weight:600;font-family:'IBM Plex Mono',monospace;padding:0 4px;border-radius:3px;min-width:30px;text-align:right">20</span>
        </label>
        <input type="range" style="width:100%;accent-color:var(--ac);cursor:pointer" min="1" max="100" step="1" value="20">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--t3);margin-top:1px"><span>1</span><span>50</span><span>100</span></div>
      </div>

      <p class="dev-sub" style="margin-top: 16px;">新组件 RangeField</p>
      <RangeField
        v-model="steps"
        label="步数"
        :min="1" :max="100" :step="1"
        :marks="2"
        editable
      />
    </div>

    <!-- ===== 去噪强度 + 放大倍数 (2列) ===== -->
    <div>
      <h2 class="dev-label">更多 RangeField — 去噪 (2 decimals) + 放大倍数 (suffix marks)</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
        <RangeField
          v-model="denoise"
          label="去噪强度"
          :min="0.1" :max="0.9" :step="0.01"
          :marks="2"
          editable
        />
        <RangeField
          v-model="upscale"
          label="放大倍数"
          :min="1.5" :max="4" :step="0.5"
          :marks="['1.5x','2x','2.5x','3x','3.5x','4x']"
          :value-format="v => v.toFixed(1) + 'x'"
          editable
        />
      </div>
    </div>

  </div>
</template>

<style scoped>
.dev-label {
  color: var(--t1);
  font-size: .88rem;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--bd);
}

.dev-sub {
  font-size: .75rem;
  color: var(--t3);
  margin: 0 0 6px;
}
</style>
