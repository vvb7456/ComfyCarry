class SigmaScheduler:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"sigmas": ("SIGMAS",)}}

    RETURN_TYPES = ("SCHEDULER_FUNC",)
    FUNCTION = "build"
    CATEGORY = "ComfyCarry/sampling"

    def build(self, sigmas):
        def schedule(model, sampler_name, steps):
            return sigmas.clone()

        return (schedule,)
