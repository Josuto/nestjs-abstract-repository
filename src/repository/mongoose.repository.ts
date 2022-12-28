import { Repository } from './repository';
import { Optional } from 'typescript-optional';
import mongoose, { HydratedDocument, Model } from 'mongoose';
import { Injectable } from '@nestjs/common';
import { Entity } from '../entity';
import {
  IllegalArgumentException,
  NotFoundException,
  UniquenessViolationException,
} from '../exceptions';

type Constructor<T> = new (...args: any) => T;

export interface ConstructorMap<T> {
  [index: string]: Constructor<T>;
}

@Injectable()
export abstract class MongooseRepository<T extends Entity>
  implements Repository<T>
{
  protected constructor(
    protected readonly elementModel: Model<T>,
    protected readonly elementConstructor: ConstructorMap<T> | Constructor<T>,
  ) {}

  async deleteById(id: string): Promise<boolean> {
    if (!id) throw new IllegalArgumentException('The given ID must be valid');
    const isDeleted = await this.elementModel.findByIdAndDelete(id);
    return !!isDeleted;
  }

  async findAll<S extends T>(): Promise<S[]> {
    return this.elementModel
      .find()
      .exec()
      .then((documents) =>
        documents.map((document) => this.instantiateFrom(document)),
      );
  }

  async findById<S extends T>(id: string): Promise<Optional<S>> {
    if (!id) throw new IllegalArgumentException('The given ID must be valid');
    const element: S | null = await this.elementModel
      .findById(id)
      .exec()
      .then((document) =>
        document ? (this.instantiateFrom(document) as S) : null,
      );
    return Optional.ofNullable(element);
  }

  async save<S extends T>(element: S): Promise<S> {
    if (!element)
      throw new IllegalArgumentException('The given element must be valid');
    let document;
    if (!element.id) {
      document = await this.insert(element);
    } else {
      document = await this.update(element);
    }
    if (document) return this.instantiateFrom(document) as S;
    throw new NotFoundException(
      `There is no document matching the given ID ${element.id}. New elements cannot not specify an ID`,
    );
  }

  private instantiateFrom<S extends T>(document: HydratedDocument<T>): S {
    let elemClass;
    const elemType = document.get('__type');
    if (elemType) {
      elemClass = (this.elementConstructor as ConstructorMap<T>)[elemType];
    } else {
      elemClass = this.elementConstructor as Constructor<T>;
    }
    return new elemClass(document.toObject()) as S;
  }

  private async insert<S extends T>(element: S): Promise<HydratedDocument<S>> {
    try {
      return (await this.elementModel.create(element)) as HydratedDocument<S>;
    } catch (error) {
      if (error.message.includes('duplicate key error')) {
        throw new UniquenessViolationException(
          `The given element with ID ${element.id} includes a field which value is expected to be unique`,
        );
      }
      throw error;
    }
  }

  private async update<S extends T>(
    element: S,
  ): Promise<HydratedDocument<S> | null> {
    let updateModel;
    if (this.elementModel.discriminators) {
      updateModel = this.createUpdateModelForPolymorphicEntity(element);
    } else {
      updateModel = await this.createUpdateModelForPlainEntity(element);
    }
    if (updateModel) {
      updateModel.isNew = false;
      return (await updateModel.save()) as HydratedDocument<S>;
    }
    return null;
  }

  private createUpdateModelForPolymorphicEntity<S extends T>(element: S) {
    const discriminator =
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.elementModel.discriminators![element['__type']!];
    return new discriminator({
      ...element,
      _id: new mongoose.Types.ObjectId(element.id),
    });
  }

  private async createUpdateModelForPlainEntity<S extends T>(element: S) {
    const updateModel = await this.elementModel.findById(element.id);
    if (updateModel) {
      updateModel.overwrite({ ...element });
      return updateModel;
    }
    return null;
  }
}