import prisma from '../lib/prisma';

export async function getPaymentGateway(_userId: string): Promise<'mpesa'> {
  return 'mpesa';
}

export async function getPaymentGatewayByChurch(_churchId: string): Promise<'mpesa'> {
  return 'mpesa';
}

export function getCurrency(_gateway: 'mpesa'): string {
  return 'KES';
}

export function getGatewayCountry(_gateway: 'mpesa'): string {
  return 'Kenya';
}
