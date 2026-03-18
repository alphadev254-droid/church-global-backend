import prisma from '../lib/prisma';

export async function getPaymentGateway(userId: string): Promise<'paystack' | 'paychangu'> {
  console.log(`[GATEWAY] Getting payment gateway for userId: ${userId}`);
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountCountry: true, ministryAdminId: true, churchId: true }
  });

  console.log(`[GATEWAY] User found:`, { accountCountry: user?.accountCountry, ministryAdminId: user?.ministryAdminId, churchId: user?.churchId });

  let country = user?.accountCountry;
  console.log(`[GATEWAY] Initial country from user: ${country}`);

  // For regional/district/local admins, get country from their national admin
  if (!country && user?.ministryAdminId) {
    console.log(`[GATEWAY] No country, checking ministryAdminId: ${user.ministryAdminId}`);
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: user.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
    console.log(`[GATEWAY] Country from national admin: ${country}`);
  }

  // For members, get country from church's national admin
  if (!country && user?.churchId) {
    console.log(`[GATEWAY] No country, checking church: ${user.churchId}`);
    const church = await prisma.church.findUnique({
      where: { id: user.churchId },
      select: { ministryAdminId: true }
    });
    console.log(`[GATEWAY] Church ministryAdminId: ${church?.ministryAdminId}`);
    
    if (church?.ministryAdminId) {
      const ministryAdmin = await prisma.user.findUnique({
        where: { id: church.ministryAdminId },
        select: { accountCountry: true }
      });
      country = ministryAdmin?.accountCountry;
      console.log(`[GATEWAY] Country from church's national admin: ${country}`);
    }
  }

  const gateway = country === 'Malawi' ? 'paychangu' : 'paystack';
  console.log(`[GATEWAY] Final decision - Country: ${country}, Gateway: ${gateway}`);
  
  return gateway;
}

export async function getPaymentGatewayByChurch(churchId: string): Promise<'paystack' | 'paychangu'> {
  console.log(`[GATEWAY] Getting payment gateway for churchId: ${churchId}`);

  const church = await prisma.church.findUnique({
    where: { id: churchId },
    select: { ministryAdminId: true }
  });

  let country: string | null | undefined;

  if (church?.ministryAdminId) {
    const ministryAdmin = await prisma.user.findUnique({
      where: { id: church.ministryAdminId },
      select: { accountCountry: true }
    });
    country = ministryAdmin?.accountCountry;
  }

  const gateway = country === 'Malawi' ? 'paychangu' : 'paystack';
  console.log(`[GATEWAY] Church gateway - Country: ${country}, Gateway: ${gateway}`);
  return gateway;
}

export function getCurrency(gateway: 'paystack' | 'paychangu'): string {
  return gateway === 'paychangu' ? 'MWK' : 'KES';
}

export function getGatewayCountry(gateway: 'paystack' | 'paychangu'): string {
  return gateway === 'paychangu' ? 'Malawi' : 'Kenya';
}
