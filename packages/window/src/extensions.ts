import type { IInstantiationService, Service, ServiceId } from "@milu/di";

export interface FrontEndService<T extends Service = Service> {
	readonly id: ServiceId<T>;
	readonly create: (services: IInstantiationService) => T;
}
