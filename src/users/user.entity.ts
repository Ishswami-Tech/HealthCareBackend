import { ApiProperty } from "@nestjs/swagger";
import { Role, Gender } from "@prisma/client";

export class CreateUserDto {
  @ApiProperty()
  email: string;

  @ApiProperty()
  password: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  age: number;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: Role, default: Role.PATIENT })
  role: Role;

  @ApiProperty({ required: false })
  profilePicture?: string | null;

  @ApiProperty({ enum: Gender, required: false })
  gender?: Gender | null;

  @ApiProperty({ required: false })
  dateOfBirth?: Date | null;

  @ApiProperty({ required: false })
  address?: string | null;

  @ApiProperty({ required: false })
  city?: string | null;

  @ApiProperty({ required: false })
  state?: string | null;

  @ApiProperty({ required: false })
  country?: string | null;

  @ApiProperty({ required: false })
  zipCode?: string | null;

  @ApiProperty({ default: false })
  isVerified: boolean;
}

export class UserResponseDto extends CreateUserDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ required: false })
  lastLogin?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
