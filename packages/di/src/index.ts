export {
	createDecorator,
	createServiceId,
	IInstantiationService,
	InstantiationService,
	ServiceCollection,
	SyncDescriptor,
	type Constructor,
	type ServiceDescriptor,
	type ServiceFactory,
	type ServiceId,
	type ServiceIdentifier,
} from "./instantiation.ts";
export { Emitter, type Event } from "./events.ts";
export { DisposableStore } from "./lifecycle.ts";
export type { Disposable, Service } from "./lifecycle.ts";
