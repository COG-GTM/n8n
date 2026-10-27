<script setup lang="ts">
import { createEventBus } from '@n8n/utils/event-bus';
import Modal from '@/app/components/Modal.vue';
import { WORKFLOW_ACTIVATION_CONFLICTING_WEBHOOK_MODAL_KEY } from '@/app/constants';
import { useUIStore } from '@/app/stores/ui.store';

import { useRootStore } from '@n8n/stores/useRootStore';
import { computed } from 'vue';
import { CHAT_TRIGGER_NODE_TYPE, FORM_TRIGGER_NODE_TYPE, WEBHOOK_NODE_TYPE } from 'n8n-workflow';

import { N8nButton, N8nCallout, N8nLink, N8nText } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
const modalBus = createEventBus();
const i18n = useI18n();
const uiStore = useUIStore();
const rootStore = useRootStore();

const props = defineProps<{
	data: {
		workflowName?: string;
		triggerType: string;
		workflowId?: string;
		webhookPath: string;
		node?: string;
	};
}>();

const { data } = props;

const webhookUrl = computed(() => {
	return rootStore.webhookUrl;
});

const SUGGESTION_BASE = 'and activate this one, or ';

const webhookTypeUi = computed((): { title: string; callout: string; action: string } => {
	if (data.triggerType === FORM_TRIGGER_NODE_TYPE)
		return {
			title: 'Form',
			callout: 'form trigger',
			action: 'adjust the following URL path in either workflow:',
		};
	if (data.triggerType === CHAT_TRIGGER_NODE_TYPE)
		return {
			title: 'Chat',
			callout: 'chat trigger',
			action: 'insert a new Chat Trigger node in either workflow:',
		};
	if (data.triggerType === WEBHOOK_NODE_TYPE)
		return {
			title: 'Webhook',
			callout: 'webhook trigger',
			action: 'adjust the following URL path in either workflow:',
		};

	return {
		title: 'Trigger',
		callout: 'trigger',
		action: 'insert a new trigger node of the same type in either workflow:',
	};
});

const isConflictingWorkflowAccessible = computed(() => !!data.workflowId);

const workflowUrl = computed(() => {
	return rootStore.urlBaseEditor + 'workflow/' + data.workflowId;
});

const onClick = async () => {
	uiStore.closeModal(WORKFLOW_ACTIVATION_CONFLICTING_WEBHOOK_MODAL_KEY);
};
</script>

<template>
	<Modal
		width="540px"
		:name="WORKFLOW_ACTIVATION_CONFLICTING_WEBHOOK_MODAL_KEY"
		:title="`Conflicting ${webhookTypeUi.title} Path`"
		:event-bus="modalBus"
		:center="true"
	>
		<template #content>
			<N8nCallout
				v-if="isConflictingWorkflowAccessible"
				theme="danger"
				data-test-id="conflicting-webhook-callout"
			>
				A {{ webhookTypeUi.callout }} '{{ data.node }}' in the workflow '{{ data.workflowName }}'
				uses a conflicting URL path, so this workflow cannot be activated
			</N8nCallout>
			<N8nCallout v-else theme="danger" data-test-id="conflicting-webhook-callout">
				{{
					i18n.baseText('workflowActivator.conflictingWebhook.inaccessibleWorkflow.callout', {
						interpolate: { triggerType: webhookTypeUi.callout },
					})
				}}
			</N8nCallout>
			<div :class="$style.container">
				<div v-if="!isConflictingWorkflowAccessible">
					<N8nText color="text-base" data-test-id="conflicting-webhook-suggestion">
						{{
							i18n.baseText('workflowActivator.conflictingWebhook.inaccessibleWorkflow.suggestion', {
								interpolate: { action: webhookTypeUi.action },
							})
						}}
					</N8nText>
				</div>
				<div v-else>
					<N8nText color="text-base"> You can deactivate </N8nText>
					<N8nLink :to="workflowUrl" :underline="true"> {{ data.workflowName }} </N8nLink>
					<N8nText color="text-base" data-test-id="conflicting-webhook-suggestion">
						{{ SUGGESTION_BASE + webhookTypeUi.action }}
					</N8nText>
				</div>
			</div>
			<div data-test-id="conflicting-webhook-path">
				<N8nText color="text-light"> {{ webhookUrl }}/</N8nText>
				<N8nText color="text-dark" bold>
					{{ data.webhookPath }}
				</N8nText>
			</div>
		</template>
		<template #footer>
			<N8nButton
				label="Done"
				size="medium"
				float="right"
				data-test-id="close-button"
				@click="onClick"
			/>
		</template>
	</Modal>
</template>

<style module lang="scss">
.container {
	margin-top: var(--spacing--md);
	margin-bottom: var(--spacing--sm);
}
</style>
