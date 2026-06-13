/**
 * User types and interfaces
 */
export interface IUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateUserRequest {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export interface IUpdateUserRequest {
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Authentication types
 */
export interface IAuthPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface ILoginResponse {
  accessToken: string;
  refreshToken: string;
  user: IUser;
}

/**
 * API Response types
 */
export interface IApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  timestamp: string;
}

export interface IPaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
